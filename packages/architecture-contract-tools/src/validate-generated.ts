import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentToolDescriptorSchema,
  canonicalJson,
  MetricScalarSchema,
  PluginManifestSchema,
  TableRecordsSchema
} from "@k-nex/contracts";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormatsModule.default(ajv);

const circular: { self?: unknown } = {};
circular.self = circular;
for (const unsupported of [undefined, Number.NaN, 1n, new Date(0), { value: undefined }, circular]) {
  try {
    canonicalJson(unsupported);
    throw new Error("Canonical JSON accepted an unsupported JavaScript value.");
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
}

async function load<T = unknown>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repositoryRoot, relativePath), "utf8")) as T;
}

async function loadCanonical<T = unknown>(relativePath: string): Promise<T> {
  const content = await readFile(resolve(repositoryRoot, relativePath), "utf8");
  if (!content.endsWith("\n") || content.endsWith("\n\n") || content.includes("\r")) throw new Error(`${relativePath} must use LF and one final newline.`);
  const value = JSON.parse(content) as T;
  assertCanonical(value, relativePath);
  return value;
}

function assertCanonical(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonical(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;

  const keys = Object.keys(value);
  const sorted = [...keys].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (keys.some((key, index) => key !== sorted[index])) throw new Error(`Generated JSON keys are not sorted at ${path}.`);
  for (const [key, child] of Object.entries(value)) assertCanonical(child, `${path}.${key}`);
}

for (const relativePath of [
  "contracts/architecture-contracts.v1.json",
  "contracts/generated-contracts.v1.json",
  "schemas/agent-tool.v1.schema.json",
  "schemas/plugin-manifest.v1.schema.json",
  "schemas/application-manifest.v1.schema.json",
  "schemas/metric-scalar.v1.schema.json",
  "schemas/table-records.v1.schema.json",
  "fixtures/agent-tools/valid/read.json",
  "fixtures/agent-tools/invalid/executable-handler.json",
  "fixtures/output-contracts/valid/metric-scalar.json",
  "fixtures/output-contracts/valid/table-records.json",
  "fixtures/output-contracts/invalid/metric-scalar.json",
  "fixtures/output-contracts/invalid/table-records.json"
]) {
  await loadCanonical(relativePath);
}

const pluginSchema = await load<AnySchema>("schemas/plugin-manifest.v1.schema.json");
const agentToolSchema = await load<AnySchema>("schemas/agent-tool.v1.schema.json");
const applicationSchema = await load<AnySchema>("schemas/application-manifest.v1.schema.json");
const metricSchema = await load<AnySchema>("schemas/metric-scalar.v1.schema.json");
const tableSchema = await load<AnySchema>("schemas/table-records.v1.schema.json");
const validatePlugin = ajv.compile(pluginSchema);
const validateAgentTool = ajv.compile(agentToolSchema);
ajv.compile(applicationSchema);
const validateMetric = ajv.compile(metricSchema);
const validateTable = ajv.compile(tableSchema);

const generatedContracts = await load<{
  artifacts: string[];
  outputContracts: Array<{ id: string; schema: string }>;
}>("contracts/generated-contracts.v1.json");
const outputContractSchemas = [
  { id: "metric.scalar@1", schema: "schemas/metric-scalar.v1.schema.json" },
  { id: "table.records@1", schema: "schemas/table-records.v1.schema.json" }
];
if (JSON.stringify(generatedContracts.outputContracts) !== JSON.stringify(outputContractSchemas)) {
  throw new Error("Generated output-contract registry entries are stale or out of order.");
}
for (const { schema } of outputContractSchemas) {
  if (!generatedContracts.artifacts.includes(schema)) throw new Error(`Generated artifact inventory is missing ${schema}.`);
}

const driver = await load("fixtures/plugin-manifests/module.logistics.driver.json");
if (!PluginManifestSchema.safeParse(driver).success) throw new Error("Valid driver fixture failed the Zod authoring schema.");
if (!validatePlugin(driver)) throw new Error(`Valid driver fixture failed generated schema: ${ajv.errorsText(validatePlugin.errors)}`);

const invalidLifecycle = structuredClone(driver) as { lifecycle: { uninstall: string } };
invalidLifecycle.lifecycle.uninstall = "supported";
if (PluginManifestSchema.safeParse(invalidLifecycle).success) throw new Error("Zod authoring schema accepted retained-schema uninstall for a schema-owning V1 plugin.");
if (validatePlugin(invalidLifecycle)) throw new Error("Generated schema accepted retained-schema uninstall for a schema-owning V1 plugin.");

const validAgentTool = await load("fixtures/agent-tools/valid/read.json");
if (!AgentToolDescriptorSchema.safeParse(validAgentTool).success || !validateAgentTool(validAgentTool)) {
  throw new Error(`Valid agent-tool fixture failed its authoring or generated schema: ${ajv.errorsText(validateAgentTool.errors)}`);
}
const invalidAgentTool = await load("fixtures/agent-tools/invalid/executable-handler.json");
if (AgentToolDescriptorSchema.safeParse(invalidAgentTool).success || validateAgentTool(invalidAgentTool)) {
  throw new Error("Executable agent-tool fixture must fail both authoring and generated schemas.");
}

const outputContractFixtures = [
  { path: "fixtures/output-contracts/valid/metric-scalar.json", schema: MetricScalarSchema, validate: validateMetric, valid: true },
  { path: "fixtures/output-contracts/valid/table-records.json", schema: TableRecordsSchema, validate: validateTable, valid: true },
  { path: "fixtures/output-contracts/invalid/metric-scalar.json", schema: MetricScalarSchema, validate: validateMetric, valid: false },
  { path: "fixtures/output-contracts/invalid/table-records.json", schema: TableRecordsSchema, validate: validateTable, valid: false }
] as const;
for (const fixture of outputContractFixtures) {
  const value = await load(fixture.path);
  const zodValid = fixture.schema.safeParse(value).success;
  const jsonSchemaValid = fixture.validate(value);
  if (fixture.valid && (!zodValid || !jsonSchemaValid)) {
    throw new Error(`Valid ${fixture.path} must pass both Zod and generated JSON Schema validation.`);
  }
  if (!fixture.valid && (zodValid || jsonSchemaValid)) {
    throw new Error(`Structurally invalid ${fixture.path} must fail both Zod and generated JSON Schema validation.`);
  }
}

console.log("Generated schemas compile with Ajv and preserve contract and lifecycle invariants.");
