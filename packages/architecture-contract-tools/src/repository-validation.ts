import { existsSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";

import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { canonicalJson } from "./canonical-json.js";
import { type FixtureInput, type FixtureSchema, validateFixtures } from "./fixture-validation.js";

export type RepositoryDiagnosticCode =
  | "ADR_EVIDENCE_INVALID"
  | "EXPECTED_DIAGNOSTIC_MISMATCH"
  | "GENERATED_ARTIFACT_INVALID"
  | "JSON_INVALID"
  | "LEGACY_SYMBOL_FORBIDDEN"
  | "MARKDOWN_LINK_INVALID"
  | "SCHEMA_INVALID";

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

interface ExpectedDiagnostic {
  code: string;
  schema: FixtureSchema;
  validator: string;
}

const generatedArtifacts = [
  "contracts/architecture-contracts.v1.json",
  "contracts/generated-contracts.v1.json",
  "schemas/application-manifest.v1.schema.json",
  "schemas/plugin-manifest.v1.schema.json"
] as const;
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
  return [...diagnostics].sort((left, right) =>
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
  for (const key of ["absolutePath", "buildTimestamp", "generatedAt", "hostname"]) {
    if (content.includes(`"${key}"`)) {
      diagnostics.push(diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", `$/${key}`, `Generated artifact contains forbidden key ${key}.`, "Remove environment-dependent data from committed generated artifacts.", "generated-artifact"));
    }
  }
  return diagnostics;
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
  const pattern = /\[[^\]]+\]\((\.{1,2}\/[^)#?]+)(?:#[^)]+)?\)/g;
  for (const match of content.matchAll(pattern)) {
    const target = match[1];
    if (target !== undefined && !targetExists(target)) {
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
    const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
    for (const [index, path] of evidence.entries()) {
      if (typeof path !== "string" || !evidenceExists(path)) diagnostics.push(diagnostic(sourcePath, "ADR_EVIDENCE_INVALID", `$/records/${id}/evidence/${index}`, `ADR ${id} references missing evidence: ${String(path)}`, "Point evidence at an existing repository path.", "adr-evidence"));
    }
  }
  return diagnostics;
}

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) => compare(left.name, right.name))) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(child));
    else if (entry.isFile()) paths.push(child);
  }
  return paths;
}

function repositoryPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
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
  const diagnostics: RepositoryDiagnostic[] = [];
  const registryValue = await loadJson(root, "contracts/architecture-contracts.v1.json", diagnostics);
  const pluginSchema = await loadJson(root, "schemas/plugin-manifest.v1.schema.json", diagnostics);
  const applicationSchema = await loadJson(root, "schemas/application-manifest.v1.schema.json", diagnostics);
  const expectedValue = await loadJson(root, "fixtures/contracts/expected-diagnostics.json", diagnostics);
  if (registryValue === undefined || pluginSchema === undefined || applicationSchema === undefined || expectedValue === undefined) return sortDiagnostics(diagnostics);

  const registry = registryValue as Registry;
  const expected = expectedValue as Record<string, ExpectedDiagnostic>;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  let validators: { application: ValidateFunction; plugin: ValidateFunction };
  try {
    validators = { application: ajv.compile(applicationSchema as AnySchema), plugin: ajv.compile(pluginSchema as AnySchema) };
  } catch (error) {
    diagnostics.push(diagnostic("schemas", "SCHEMA_INVALID", "$", error instanceof Error ? error.message : "Generated schema compilation failed.", "Regenerate or correct the contract schemas.", "json-schema"));
    return sortDiagnostics(diagnostics);
  }

  const validPaths = [
    "fixtures/contracts/valid/application.minimal.json",
    "fixtures/contracts/valid/provider.realtime.socketio.json",
    "fixtures/contracts/valid/theme.minimal.json",
    "fixtures/plugin-manifests/module.logistics.driver.json"
  ];
  const validFixtures: FixtureInput[] = [];
  for (const sourcePath of validPaths) {
    const value = await loadJson(root, sourcePath, diagnostics);
    if (value !== undefined) validFixtures.push({ fixturePath: sourcePath, schema: sourcePath.includes("application.") ? "application" : "plugin", value });
  }
  const pluginCapabilities = new Map<string, ReadonlySet<string>>();
  for (const item of validFixtures.filter(({ schema }) => schema === "plugin")) {
    const manifest = item.value as { id?: unknown; provides?: Array<{ capability?: unknown }> };
    if (typeof manifest.id === "string") pluginCapabilities.set(manifest.id, new Set((manifest.provides ?? []).flatMap(({ capability }) => typeof capability === "string" ? [capability] : [])));
  }
  diagnostics.push(...validateFixtures(validFixtures, registry, validators, pluginCapabilities).map((item) =>
    diagnostic(item.fixturePath, item.code, item.path, `Valid fixture failed with ${item.code}.`, item.remediation, item.validator)
  ));

  for (const sourcePath of Object.keys(expected).sort()) {
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
  if (evidence !== undefined) diagnostics.push(...validateEvidenceRegistry(evidence, new Set(adrFiles.map((path) => repositoryPath(root, path).split("/").at(-1)?.slice(0, 4) ?? "")), (path) => requireExists(root, path)));

  for (const path of (await walk(resolve(root, "docs"))).filter((item) => extname(item) === ".md")) {
    const sourcePath = repositoryPath(root, path);
    diagnostics.push(...validateMarkdownText(sourcePath, await readFile(path, "utf8"), (target) => {
      const destination = resolve(dirname(path), target);
      return (destination === root || destination.startsWith(`${root}${sep}`)) && existsSync(destination);
    }));
  }

  for (const sourcePath of generatedArtifacts) {
    const content = await readFile(resolve(root, sourcePath), "utf8").catch((error: unknown) => {
      diagnostics.push(diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", "$", error instanceof Error ? error.message : "Generated artifact cannot be read.", "Regenerate the committed contract artifacts.", "generated-artifact"));
      return undefined;
    });
    if (content === undefined) continue;
    const parsed = parseJsonDocument(sourcePath, content);
    if (parsed.value !== undefined) diagnostics.push(...validateGeneratedDocument(sourcePath, content, parsed.value));
  }
  for (const path of await walk(resolve(root, ".k-nex/generated"))) {
    if (![".json", ".ts"].includes(extname(path))) continue;
    const sourcePath = repositoryPath(root, path);
    const content = await readFile(path, "utf8");
    for (const key of ["absolutePath", "buildTimestamp", "generatedAt", "hostname"]) {
      if (content.includes(key)) diagnostics.push(diagnostic(sourcePath, "GENERATED_ARTIFACT_INVALID", `$/${key}`, `Generated artifact contains forbidden key ${key}.`, "Remove environment-dependent data from committed generated artifacts.", "generated-artifact"));
    }
  }
  return sortDiagnostics(diagnostics);
}

function requireExists(root: string, path: string): boolean {
  return existsSync(resolve(root, path));
}

export function formatDiagnostics(diagnostics: readonly RepositoryDiagnostic[], format: "human" | "json"): string {
  if (format === "json") return `${JSON.stringify(sortDiagnostics(diagnostics), null, 2)}\n`;
  if (diagnostics.length === 0) return "Executable repository contract validation passed.\n";
  return `${sortDiagnostics(diagnostics).map((item) => `${item.sourcePath} ${item.code} ${item.path}: ${item.message} Remediation: ${item.remediation}`).join("\n")}\n`;
}
