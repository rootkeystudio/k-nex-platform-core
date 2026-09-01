import { existsSync, lstatSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, posix, relative, resolve, sep, win32 } from "node:path";

import { canonicalJson } from "@k-nex/contracts";
import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { fixtureSchemas, type FixtureInput, type FixtureSchema, validateFixtures } from "./fixture-validation.js";
import { registerPluginContributionOwnershipKeyword } from "./plugin-contribution-ownership.js";
import { registerMigrationRevisionKeyword } from "./migration-compatibility-plan.js";
import { registerAuthorizationOwnershipKeyword } from "./authorization-ownership.js";

export type RepositoryDiagnosticCode =
  | "ADR_EVIDENCE_INVALID"
  | "EXPECTED_DIAGNOSTIC_MISMATCH"
  | "GENERATED_ARTIFACT_INVALID"
  | "JSON_INVALID"
  | "LEGACY_SYMBOL_FORBIDDEN"
  | "MARKDOWN_LINK_INVALID"
  | "SCHEMA_INVALID"
  | "VALID_FIXTURE_MISSING";

export interface RepositoryDiagnostic {
  code: RepositoryDiagnosticCode | string;
  message: string;
  path: string;
  remediation: string;
  sourcePath: string;
  validator: string;
}

interface Registry {
  forbiddenLegacySymbols: string[];
  identity: { capabilityIdPattern: string; pluginIdPattern: string };
}

export interface ExpectedDiagnostic {
  code: string;
  schema: FixtureSchema;
  validator: string;
}

const generatedInventoryPath = "contracts/generated-contracts.v1.json";
const forbiddenGeneratedKeys = new Set(["absolutePath", "buildTimestamp", "generatedAt", "hostname"]);
const scanExtensions = new Set([".json", ".md", ".ts", ".tsx", ".yaml", ".yml"]);

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnostic(
  sourcePath: string,
  code: RepositoryDiagnostic["code"],
  path: string,
  message: string,
  remediation: string,
  validator: string
): RepositoryDiagnostic {
  return { code, message, path, remediation, sourcePath, validator };
}

export function sortDiagnostics(diagnostics: readonly RepositoryDiagnostic[]): RepositoryDiagnostic[] {
  const unique = new Map(diagnostics.map((item) => [JSON.stringify(item), item]));
  return [...unique.values()].sort((left, right) =>
    compare(left.sourcePath, right.sourcePath) || compare(left.code, right.code) || compare(left.path, right.path) || compare(left.message, right.message)
  );
}

export function parseJsonDocument(sourcePath: string, content: string): { diagnostics: RepositoryDiagnostic[]; value?: unknown } {
  try {
    return { diagnostics: [], value: JSON.parse(content) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    return {
      diagnostics: [diagnostic(sourcePath, "JSON_INVALID", "$", message, "Fix the JSON syntax before running contract validation again.", "json-parser")]
    };
  }
}

export function validateGeneratedDocument(sourcePath: string, content: string, value: unknown): RepositoryDiagnostic[] {
  const diagnostics: RepositoryDiagnostic[] = [];
  try {
    if (canonicalJson(value) !== content) {
      diagnostics.push(diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", "$", "Generated JSON is not canonical UTF-8 JSON with sorted keys and one final newline.", "Regenerate the committed contract artifacts.", "generated-artifact"));
    }
  } catch (error) {
    diagnostics.push(diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", "$", error instanceof Error ? error.message : "Generated JSON is not canonical.", "Regenerate the committed contract artifacts.", "generated-artifact"));
  }
  diagnostics.push(...validateForbiddenGeneratedKeys(sourcePath, value));
  return diagnostics;
}

export function validateForbiddenGeneratedKeys(sourcePath: string, value: unknown, path = "$"): RepositoryDiagnostic[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => validateForbiddenGeneratedKeys(sourcePath, item, `${path}/${index}`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const own = forbiddenGeneratedKeys.has(key)
      ? [diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", childPath, `Generated artifact contains forbidden key ${key}.`, "Remove environment-dependent data from committed generated artifacts.", "generated-artifact")]
      : [];
    return [...own, ...validateForbiddenGeneratedKeys(sourcePath, child, childPath)];
  });
}

export function validateGeneratedInventory(
  value: unknown,
  artifactExists: (path: string) => boolean
): { artifacts: string[]; diagnostics: RepositoryDiagnostic[] } {
  const diagnostics: RepositoryDiagnostic[] = [];
  const artifactsValue = value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as { artifacts?: unknown }).artifacts
    : undefined;
  if (!Array.isArray(artifactsValue)) {
    return {
      artifacts: [],
      diagnostics: [diagnostic(generatedInventoryPath, "GENERATED_ARTIFACT_INVALID", "$/artifacts", "Generated artifact inventory must be an array.", "Regenerate the generated-contracts sidecar.", "generated-artifact")]
    };
  }

  const artifacts: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of artifactsValue.entries()) {
    const path = typeof value === "string" ? value : "";
    const location = `$/artifacts/${index}`;
    if (repositoryTarget("/repository", path) === undefined || path === generatedInventoryPath) {
      diagnostics.push(diagnostic(generatedInventoryPath, "GENERATED_ARTIFACT_INVALID", location, `Unsafe generated artifact inventory entry: ${String(value)}`, "Use a normalized repository-relative artifact path.", "generated-artifact"));
      continue;
    }
    if (seen.has(path)) {
      diagnostics.push(diagnostic(generatedInventoryPath, "GENERATED_ARTIFACT_INVALID", location, `Duplicate generated artifact inventory entry: ${path}`, "Keep each generated artifact path exactly once.", "generated-artifact"));
      continue;
    }
    seen.add(path);
    artifacts.push(path);
    if (!artifactExists(path)) diagnostics.push(diagnostic(generatedInventoryPath, "GENERATED_ARTIFACT_INVALID", location, `Inventoried generated artifact is missing: ${path}`, "Regenerate or restore the inventoried artifact.", "generated-artifact"));
  }
  return { artifacts, diagnostics };
}

export async function validateGeneratedArtifacts(root: string): Promise<RepositoryDiagnostic[]> {
  const diagnostics: RepositoryDiagnostic[] = [];
  const inventoryContent = await readFile(resolve(root, generatedInventoryPath), "utf8").catch((error: unknown) => {
    diagnostics.push(diagnostic(generatedInventoryPath, "GENERATED_ARTIFACT_INVALID", "$", error instanceof Error ? error.message : "Generated inventory cannot be read.", "Regenerate the generated-contracts sidecar.", "generated-artifact"));
    return undefined;
  });
  if (inventoryContent === undefined) return diagnostics;

  const parsed = parseJsonDocument(generatedInventoryPath, inventoryContent);
  diagnostics.push(...parsed.diagnostics);
  if (parsed.value === undefined) return diagnostics;
  diagnostics.push(...validateGeneratedDocument(generatedInventoryPath, inventoryContent, parsed.value));

  const inventory = validateGeneratedInventory(parsed.value, (path) => repositoryFileExists(root, path));
  diagnostics.push(...inventory.diagnostics);
  for (const sourcePath of inventory.artifacts) {
    const target = repositoryTarget(root, sourcePath);
    if (target === undefined || !repositoryFileExists(root, sourcePath)) continue;
    const content = await readFile(target, "utf8").catch((error: unknown) => {
      diagnostics.push(diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", "$", error instanceof Error ? error.message : "Inventoried artifact cannot be read.", "Restore a readable regular generated artifact file.", "generated-artifact"));
      return undefined;
    });
    if (content === undefined) continue;
    const artifact = parseJsonDocument(sourcePath, content);
    diagnostics.push(...artifact.diagnostics);
    if (artifact.value !== undefined) diagnostics.push(...validateGeneratedDocument(sourcePath, content, artifact.value));
  }
  return sortDiagnostics(diagnostics);
}

export function validateLegacyText(sourcePath: string, content: string, symbols: readonly string[]): RepositoryDiagnostic[] {
  return symbols.filter((symbol) => content.includes(symbol)).map((symbol) =>
    diagnostic(sourcePath, "LEGACY_SYMBOL_FORBIDDEN", "$", `Forbidden legacy symbol found: ${symbol}`, "Replace the deprecated symbol with its canonical contract identity.", "legacy-symbol")
  );
}

export function validateMarkdownText(
  sourcePath: string,
  content: string,
  targetExists: (target: string) => boolean
): RepositoryDiagnostic[] {
  const diagnostics: RepositoryDiagnostic[] = [];
  const pattern = /\[[^\]]+\]\(([^)\s]+)\)/g;
  for (const match of content.matchAll(pattern)) {
    const reference = match[1];
    if (reference === undefined || reference.startsWith("#") || reference.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(reference)) continue;
    const target = reference.split(/[?#]/, 1)[0];
    if (target !== undefined && target !== "" && !targetExists(target)) {
      diagnostics.push(diagnostic(sourcePath, "MARKDOWN_LINK_INVALID", target, `Local Markdown link target does not exist: ${target}`, "Correct the relative link or add the referenced repository file.", "markdown-link"));
    }
  }
  return diagnostics;
}

export function validateEvidenceRegistry(
  value: unknown,
  adrIds: ReadonlySet<string>,
  evidenceExists: (path: string) => boolean
): RepositoryDiagnostic[] {
  const sourcePath = "docs/adr/evidence-registry.json";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [diagnostic(sourcePath, "ADR_EVIDENCE_INVALID", "$", "Evidence registry must be a JSON object.", "Restore the evidence registry object structure.", "adr-evidence")];
  }
  const registry = value as { levels?: unknown; records?: unknown };
  const levels = new Set(Array.isArray(registry.levels) ? registry.levels.filter((item): item is string => typeof item === "string") : []);
  const records = registry.records !== null && typeof registry.records === "object" && !Array.isArray(registry.records)
    ? registry.records as Record<string, { evidence?: unknown; level?: unknown }>
    : {};
  const diagnostics: RepositoryDiagnostic[] = [];
  for (const id of [...adrIds].filter((id) => !(id in records)).sort()) {
    diagnostics.push(diagnostic(sourcePath, "ADR_EVIDENCE_INVALID", `$/records/${id}`, `ADR ${id} has no evidence registry record.`, "Add a record for every ADR file.", "adr-evidence"));
  }
  for (const id of Object.keys(records).sort()) {
    const record = records[id];
    if (!adrIds.has(id)) diagnostics.push(diagnostic(sourcePath, "ADR_EVIDENCE_INVALID", `$/records/${id}`, `Evidence registry references absent ADR ${id}.`, "Remove the stale record or restore the ADR file.", "adr-evidence"));
    if (!levels.has(String(record?.level))) diagnostics.push(diagnostic(sourcePath, "ADR_EVIDENCE_INVALID", `$/records/${id}/level`, `ADR ${id} uses an unknown evidence level.`, "Use a level declared by the evidence registry.", "adr-evidence"));
    if (!Array.isArray(record?.evidence)) {
      diagnostics.push(diagnostic(sourcePath, "ADR_EVIDENCE_INVALID", `$/records/${id}/evidence`, `ADR ${id} evidence must be an array.`, "Declare evidence as an array of repository-relative paths.", "adr-evidence"));
    }
    const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
    for (const [index, path] of evidence.entries()) {
      if (typeof path !== "string" || !evidenceExists(path)) diagnostics.push(diagnostic(sourcePath, "ADR_EVIDENCE_INVALID", `$/records/${id}/evidence/${index}`, `ADR ${id} references missing evidence: ${String(path)}`, "Point evidence at an existing repository path.", "adr-evidence"));
    }
  }
  return diagnostics;
}

export function validateFixtureInventory(
  discoveredPaths: readonly string[],
  declaredPaths: readonly string[]
): RepositoryDiagnostic[] {
  const discovered = new Set(discoveredPaths);
  const declared = new Set(declaredPaths);
  const diagnostics: RepositoryDiagnostic[] = [];
  for (const path of [...discovered].filter((item) => !declared.has(item)).sort(compare)) {
    diagnostics.push(diagnostic(path, "EXPECTED_DIAGNOSTIC_MISMATCH", "$", "Invalid fixture has no expected diagnostic declaration.", "Add exactly one declaration to expected-diagnostics.json.", "fixture-expectation"));
  }
  for (const path of [...declared].filter((item) => !discovered.has(item)).sort(compare)) {
    diagnostics.push(diagnostic("fixtures/contracts/expected-diagnostics.json", "EXPECTED_DIAGNOSTIC_MISMATCH", `$/entries/${path}`, `Expected diagnostic references an absent invalid fixture: ${path}`, "Remove the stale declaration or restore the fixture.", "fixture-expectation"));
  }
  return diagnostics;
}

export function validateExpectedDiagnostics(value: unknown): {
  declaredPaths: string[];
  diagnostics: RepositoryDiagnostic[];
  expected: Record<string, ExpectedDiagnostic>;
} {
  const sourcePath = "fixtures/contracts/expected-diagnostics.json";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      declaredPaths: [],
      diagnostics: [diagnostic(sourcePath, "EXPECTED_DIAGNOSTIC_MISMATCH", "$", "Expected diagnostics must be a JSON object.", "Declare one diagnostic object per invalid fixture.", "fixture-expectation")],
      expected: {}
    };
  }
  const entries = value as Record<string, unknown>;
  const expected: Record<string, ExpectedDiagnostic> = {};
  const diagnostics: RepositoryDiagnostic[] = [];
  for (const path of Object.keys(entries).sort(compare)) {
    const declaration = entries[path];
    if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) {
      diagnostics.push(diagnostic(sourcePath, "EXPECTED_DIAGNOSTIC_MISMATCH", `$/entries/${path}`, `Invalid expected diagnostic declaration for ${path}.`, "Declare schema, validator, and stable code strings.", "fixture-expectation"));
      continue;
    }
    const candidate = declaration as Record<string, unknown>;
    if (!(fixtureSchemas as readonly string[]).includes(String(candidate.schema))
      || (candidate.validator !== "json-schema" && candidate.validator !== "repository-semantic")
      || typeof candidate.code !== "string" || candidate.code === "") {
      diagnostics.push(diagnostic(sourcePath, "EXPECTED_DIAGNOSTIC_MISMATCH", `$/entries/${path}`, `Invalid expected diagnostic declaration for ${path}.`, "Use a supported schema, validator, and non-empty stable code.", "fixture-expectation"));
      continue;
    }
    expected[path] = { code: candidate.code, schema: candidate.schema as FixtureSchema, validator: candidate.validator as ExpectedDiagnostic["validator"] };
  }
  return { declaredPaths: Object.keys(entries), diagnostics, expected };
}

export function declaredFixtureSchema(value: unknown): FixtureSchema | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const schema = (value as Record<string, unknown>)["$schema"];
  if (typeof schema !== "string") return undefined;
  if (schema.endsWith("/application-manifest.v1.schema.json")) return "application";
  if (schema.endsWith("/plugin-manifest.v1.schema.json")) return "plugin";
  if (schema.endsWith("/hot-application-manifest.v1.schema.json")) return "hot-application-manifest";
  if (schema.endsWith("/theme-skin-manifest.v1.schema.json")) return "theme-skin-manifest";
  if (schema.endsWith("/extension-bundle-manifest.v1.schema.json")) return "extension-bundle-manifest";
  if (schema.endsWith("/extension-capability-request.v1.schema.json")) return "extension-capability-request";
  if (schema.endsWith("/extension-resource-budget.v1.schema.json")) return "extension-resource-budget";
  if (schema.endsWith("/extension-install-plan.v1.schema.json")) return "extension-install-plan";
  if (schema.endsWith("/extension-install-receipt.v1.schema.json")) return "extension-install-receipt";
  if (schema.endsWith("/extension-generation.v1.schema.json")) return "extension-generation";
  if (schema.endsWith("/extension-lifecycle-event.v1.schema.json")) return "extension-lifecycle-event";
  if (schema.endsWith("/migration-compatibility-plan.v1.schema.json")) return "migration-compatibility-plan";
  if (schema.endsWith("/remote-ui-isolation-profile.v1.schema.json")) return "remote-ui-isolation-profile";
  if (schema.endsWith("/runner-isolation-profile.v1.schema.json")) return "runner-isolation-profile";
  if (schema.endsWith("/runtime-extension-inventory.v1.schema.json")) return "runtime-extension-inventory";
  if (schema.endsWith("/static-composition-change-plan.v1.schema.json")) return "static-composition-change-plan";
  if (schema.endsWith("/static-deployment-receipt.v1.schema.json")) return "static-deployment-receipt";
  if (schema.endsWith("/trusted-application-build-evidence.v1.schema.json")) return "trusted-application-build-evidence";
  if (schema.endsWith("/worker-generation-fence.v1.schema.json")) return "worker-generation-fence";
  if (schema.endsWith("/zero-downtime-eligibility.v1.schema.json")) return "zero-downtime-eligibility";
  if (schema.endsWith("/authorization.v1.schema.json")) return "authorization";
  return undefined;
}

export function validateValidFixtureCoverage(fixtures: readonly FixtureInput[]): RepositoryDiagnostic[] {
  const manifests = fixtures.filter(({ schema }) => schema === "plugin").map(({ value }) => value as Record<string, unknown>);
  const requirements = [
    [fixtures.some(({ schema }) => schema === "application"), "customer application"],
    [manifests.some(({ id }) => id === "module.sales"), "module.sales plugin"],
    [manifests.some(({ kind, lifecycle }) => kind === "provider" && (lifecycle as Record<string, unknown> | undefined)?.ownsPayloadSchema === false), "schema-less provider"],
    [manifests.some(({ kind }) => kind === "theme" || kind === "builder"), "theme or builder plugin"],
    [fixtures.some(({ schema }) => schema === "authorization"), "authorization contract"]
  ] as const;
  return requirements.filter(([present]) => !present).map(([, label]) =>
    diagnostic("fixtures/contracts/valid", "VALID_FIXTURE_MISSING", "$", `Required valid fixture category is missing: ${label}.`, "Restore a schema-declared fixture for every P0.3 valid category.", "fixture-coverage")
  );
}

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) => compare(left.name, right.name))) {
    if (entry.isDirectory() && entry.name === "node_modules") continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(child));
    else if (entry.isFile()) paths.push(child);
  }
  return paths;
}

function repositoryPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function repositoryTarget(root: string, path: string): string | undefined {
  if (path === "" || posix.isAbsolute(path) || win32.parse(path).root !== "" || path.includes("\\")) return undefined;
  const repositoryRoot = resolve(root);
  const destination = resolve(repositoryRoot, path);
  return destination.startsWith(`${repositoryRoot}${sep}`) && repositoryPath(repositoryRoot, destination) === path ? destination : undefined;
}

export function repositoryFileExists(root: string, path: string): boolean {
  const destination = repositoryTarget(root, path);
  if (destination === undefined) return false;
  try {
    const stat = lstatSync(destination);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function loadJson(root: string, sourcePath: string, diagnostics: RepositoryDiagnostic[]): Promise<unknown | undefined> {
  const content = await readFile(resolve(root, sourcePath), "utf8").catch((error: unknown) => {
    diagnostics.push(diagnostic(sourcePath, "JSON_INVALID", "$", error instanceof Error ? error.message : "File cannot be read.", "Restore the required JSON file.", "json-parser"));
    return undefined;
  });
  if (content === undefined) return undefined;
  const parsed = parseJsonDocument(sourcePath, content);
  diagnostics.push(...parsed.diagnostics);
  return parsed.value;
}

function excludedFromLegacyScan(path: string): boolean {
  return path === "contracts/architecture-contracts.v1.json"
    || path === "scripts/validate_repository_contracts.py"
    || path === "docs/27-architecture-review-remediation.md"
    || path === "docs/28-contract-governance-and-determinism.md"
    || path.startsWith("docs/adr/")
    || path.startsWith("fixtures/contracts/invalid/");
}

export async function validateRepository(root: string): Promise<RepositoryDiagnostic[]> {
  const diagnostics: RepositoryDiagnostic[] = [...await validateGeneratedArtifacts(root)];
  const registryValue = await loadJson(root, "contracts/architecture-contracts.v1.json", diagnostics);
  const pluginSchema = await loadJson(root, "schemas/plugin-manifest.v1.schema.json", diagnostics);
  const applicationSchema = await loadJson(root, "schemas/application-manifest.v1.schema.json", diagnostics);
  const hotApplicationSchema = await loadJson(root, "schemas/hot-application-manifest.v1.schema.json", diagnostics);
  const themeSkinSchema = await loadJson(root, "schemas/theme-skin-manifest.v1.schema.json", diagnostics);
  const extensionBundleSchema = await loadJson(root, "schemas/extension-bundle-manifest.v1.schema.json", diagnostics);
  const extensionCapabilitySchema = await loadJson(root, "schemas/extension-capability-request.v1.schema.json", diagnostics);
  const extensionBudgetSchema = await loadJson(root, "schemas/extension-resource-budget.v1.schema.json", diagnostics);
  const extensionInstallPlanSchema = await loadJson(root, "schemas/extension-install-plan.v1.schema.json", diagnostics);
  const extensionInstallReceiptSchema = await loadJson(root, "schemas/extension-install-receipt.v1.schema.json", diagnostics);
  const extensionGenerationSchema = await loadJson(root, "schemas/extension-generation.v1.schema.json", diagnostics);
  const extensionLifecycleEventSchema = await loadJson(root, "schemas/extension-lifecycle-event.v1.schema.json", diagnostics);
  const migrationCompatibilityPlanSchema = await loadJson(root, "schemas/migration-compatibility-plan.v1.schema.json", diagnostics);
  const remoteUiIsolationProfileSchema = await loadJson(root, "schemas/remote-ui-isolation-profile.v1.schema.json", diagnostics);
  const runnerIsolationProfileSchema = await loadJson(root, "schemas/runner-isolation-profile.v1.schema.json", diagnostics);
  const runtimeExtensionInventorySchema = await loadJson(root, "schemas/runtime-extension-inventory.v1.schema.json", diagnostics);
  const staticCompositionChangePlanSchema = await loadJson(root, "schemas/static-composition-change-plan.v1.schema.json", diagnostics);
  const staticDeploymentReceiptSchema = await loadJson(root, "schemas/static-deployment-receipt.v1.schema.json", diagnostics);
  const trustedApplicationBuildEvidenceSchema = await loadJson(root, "schemas/trusted-application-build-evidence.v1.schema.json", diagnostics);
  const workerGenerationFenceSchema = await loadJson(root, "schemas/worker-generation-fence.v1.schema.json", diagnostics);
  const zeroDowntimeEligibilitySchema = await loadJson(root, "schemas/zero-downtime-eligibility.v1.schema.json", diagnostics);
  const authorizationSchema = await loadJson(root, "schemas/authorization.v1.schema.json", diagnostics);
  const expectedValue = await loadJson(root, "fixtures/contracts/expected-diagnostics.json", diagnostics);
  const extensionExpectedValue = await loadJson(root, "fixtures/extensions/expected-diagnostics.json", diagnostics);
  if (registryValue === undefined || pluginSchema === undefined || applicationSchema === undefined || hotApplicationSchema === undefined || themeSkinSchema === undefined || extensionBundleSchema === undefined || extensionCapabilitySchema === undefined || extensionBudgetSchema === undefined || extensionInstallPlanSchema === undefined || extensionInstallReceiptSchema === undefined || extensionGenerationSchema === undefined || extensionLifecycleEventSchema === undefined || migrationCompatibilityPlanSchema === undefined || remoteUiIsolationProfileSchema === undefined || runnerIsolationProfileSchema === undefined || runtimeExtensionInventorySchema === undefined || staticCompositionChangePlanSchema === undefined || staticDeploymentReceiptSchema === undefined || trustedApplicationBuildEvidenceSchema === undefined || workerGenerationFenceSchema === undefined || zeroDowntimeEligibilitySchema === undefined || authorizationSchema === undefined || expectedValue === undefined || extensionExpectedValue === undefined) return sortDiagnostics(diagnostics);

  const registry = registryValue as Registry;
  const expectedResult = validateExpectedDiagnostics(expectedValue);
  diagnostics.push(...expectedResult.diagnostics);
  const extensionExpectedResult = validateExpectedDiagnostics(extensionExpectedValue);
  diagnostics.push(...extensionExpectedResult.diagnostics);
  const expected = { ...expectedResult.expected, ...extensionExpectedResult.expected };
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  registerPluginContributionOwnershipKeyword(ajv);
  registerMigrationRevisionKeyword(ajv);
  registerAuthorizationOwnershipKeyword(ajv);
  let validators: Partial<Record<FixtureSchema, ValidateFunction>>;
  try {
    validators = {
      application: ajv.compile(applicationSchema as AnySchema),
      plugin: ajv.compile(pluginSchema as AnySchema),
      "hot-application-manifest": ajv.compile(hotApplicationSchema as AnySchema),
      "theme-skin-manifest": ajv.compile(themeSkinSchema as AnySchema),
      "extension-bundle-manifest": ajv.compile(extensionBundleSchema as AnySchema),
      "extension-capability-request": ajv.compile(extensionCapabilitySchema as AnySchema),
      "extension-resource-budget": ajv.compile(extensionBudgetSchema as AnySchema),
      "extension-install-plan": ajv.compile(extensionInstallPlanSchema as AnySchema),
      "extension-install-receipt": ajv.compile(extensionInstallReceiptSchema as AnySchema),
      "extension-generation": ajv.compile(extensionGenerationSchema as AnySchema),
      "extension-lifecycle-event": ajv.compile(extensionLifecycleEventSchema as AnySchema),
      "migration-compatibility-plan": ajv.compile(migrationCompatibilityPlanSchema as AnySchema),
      "remote-ui-isolation-profile": ajv.compile(remoteUiIsolationProfileSchema as AnySchema),
      "runner-isolation-profile": ajv.compile(runnerIsolationProfileSchema as AnySchema),
      "runtime-extension-inventory": ajv.compile(runtimeExtensionInventorySchema as AnySchema),
      "static-composition-change-plan": ajv.compile(staticCompositionChangePlanSchema as AnySchema),
      "static-deployment-receipt": ajv.compile(staticDeploymentReceiptSchema as AnySchema),
      "trusted-application-build-evidence": ajv.compile(trustedApplicationBuildEvidenceSchema as AnySchema),
      "worker-generation-fence": ajv.compile(workerGenerationFenceSchema as AnySchema),
      "zero-downtime-eligibility": ajv.compile(zeroDowntimeEligibilitySchema as AnySchema),
      authorization: ajv.compile(authorizationSchema as AnySchema)
    };
  } catch (error) {
    diagnostics.push(diagnostic("schemas", "SCHEMA_INVALID", "$", error instanceof Error ? error.message : "Generated schema compilation failed.", "Regenerate or correct the contract schemas.", "json-schema"));
    return sortDiagnostics(diagnostics);
  }

  const validPaths = [...await walk(resolve(root, "fixtures/contracts/valid")), ...await walk(resolve(root, "fixtures/plugin-manifests/valid")), ...await walk(resolve(root, "fixtures/extensions/valid"))]
    .filter((path) => extname(path) === ".json")
    .map((path) => repositoryPath(root, path))
    .sort(compare);
  const validFixtures: FixtureInput[] = [];
  for (const sourcePath of validPaths) {
    const value = await loadJson(root, sourcePath, diagnostics);
    if (value === undefined) continue;
    const schema = declaredFixtureSchema(value);
    if (schema === undefined) {
      diagnostics.push(diagnostic(sourcePath, "SCHEMA_INVALID", "$/$schema", "Valid fixture does not declare a supported contract schema.", "Reference the generated application or plugin manifest schema.", "fixture-schema"));
      continue;
    }
    validFixtures.push({ fixturePath: sourcePath, schema, value });
  }
  const pluginCapabilities = new Map<string, ReadonlySet<string>>();
  for (const item of validFixtures.filter(({ schema }) => schema === "plugin")) {
    const manifest = item.value as { id?: unknown; provides?: Array<{ capability?: unknown }> };
    if (typeof manifest.id === "string") pluginCapabilities.set(manifest.id, new Set((manifest.provides ?? []).flatMap(({ capability }) => typeof capability === "string" ? [capability] : [])));
  }
  diagnostics.push(...validateFixtures(validFixtures, registry, validators, pluginCapabilities).map((item) =>
    diagnostic(item.fixturePath, item.code, item.path, `Valid fixture failed with ${item.code}.`, item.remediation, item.validator)
  ));
  diagnostics.push(...validateValidFixtureCoverage(validFixtures));

  const invalidPaths = [...await walk(resolve(root, "fixtures/contracts/invalid")), ...await walk(resolve(root, "fixtures/extensions/invalid"))]
    .filter((path) => extname(path) === ".json")
    .map((path) => repositoryPath(root, path));
  diagnostics.push(...validateFixtureInventory(invalidPaths, [...expectedResult.declaredPaths, ...extensionExpectedResult.declaredPaths]));
  for (const sourcePath of invalidPaths.filter((path) => path in expected).sort(compare)) {
    const declaration = expected[sourcePath];
    const value = await loadJson(root, sourcePath, diagnostics);
    if (value === undefined || declaration === undefined) continue;
    const actual = validateFixtures([{ fixturePath: sourcePath, schema: declaration.schema, value }], registry, validators, pluginCapabilities)[0];
    if (actual?.code !== declaration.code || actual.validator !== declaration.validator) {
      diagnostics.push(diagnostic(sourcePath, "EXPECTED_DIAGNOSTIC_MISMATCH", "$", `Expected ${declaration.validator}/${declaration.code}, received ${actual === undefined ? "no diagnostic" : `${actual.validator}/${actual.code}`}.`, "Isolate the fixture or update its declared primary diagnostic.", "fixture-expectation"));
    }
  }

  const scanRoots = ["README.md", ".github", "docs", "fixtures", "schemas"];
  for (const scanRoot of scanRoots) {
    const absolute = resolve(root, scanRoot);
    const paths = !await exists(absolute) ? [] : extname(absolute) !== "" ? [absolute] : await walk(absolute);
    for (const path of [...new Set(paths)].sort(compare)) {
      const sourcePath = repositoryPath(root, path);
      if (!scanExtensions.has(extname(path)) || excludedFromLegacyScan(sourcePath)) continue;
      diagnostics.push(...validateLegacyText(sourcePath, await readFile(path, "utf8"), registry.forbiddenLegacySymbols));
    }
  }

  const evidencePath = "docs/adr/evidence-registry.json";
  const evidence = await loadJson(root, evidencePath, diagnostics);
  const adrFiles = (await walk(resolve(root, "docs/adr"))).filter((path) => /^\d{4}-.*\.md$/.test(repositoryPath(root, path).split("/").at(-1) ?? ""));
  if (evidence !== undefined) diagnostics.push(...validateEvidenceRegistry(evidence, new Set(adrFiles.map((path) => repositoryPath(root, path).split("/").at(-1)?.slice(0, 4) ?? "")), (path) => repositoryFileExists(root, path)));

  for (const path of (await walk(resolve(root, "docs"))).filter((item) => extname(item) === ".md")) {
    const sourcePath = repositoryPath(root, path);
    diagnostics.push(...validateMarkdownText(sourcePath, await readFile(path, "utf8"), (target) => {
      const destination = resolve(dirname(path), target);
      return (destination === root || destination.startsWith(`${root}${sep}`)) && existsSync(destination);
    }));
  }

  for (const path of await walk(resolve(root, ".k-nex/generated"))) {
    if (![".json", ".ts"].includes(extname(path))) continue;
    const sourcePath = repositoryPath(root, path);
    const content = await readFile(path, "utf8");
    if (extname(path) === ".json") {
      const parsed = parseJsonDocument(sourcePath, content);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.value !== undefined) diagnostics.push(...validateForbiddenGeneratedKeys(sourcePath, parsed.value));
    } else {
      for (const key of forbiddenGeneratedKeys) {
        if (content.includes(key)) diagnostics.push(diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", `$/${key}`, `Generated TypeScript contains forbidden token ${key}.`, "Remove environment-dependent data from committed generated artifacts.", "generated-artifact"));
      }
    }
  }
  return sortDiagnostics(diagnostics);
}

export function formatDiagnostics(diagnostics: readonly RepositoryDiagnostic[], format: "human" | "json"): string {
  if (format === "json") return `${JSON.stringify(sortDiagnostics(diagnostics), null, 2)}\n`;
  if (diagnostics.length === 0) return "Executable repository contract validation passed.\n";
  return `${sortDiagnostics(diagnostics).map((item) => `${item.sourcePath} ${item.code} ${item.path}: ${item.message} Remediation: ${item.remediation}`).join("\n")}\n`;
}
