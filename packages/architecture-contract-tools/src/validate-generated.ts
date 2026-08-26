import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ActionDescriptorSchema,
  AgentToolDescriptorSchema,
  ApplicationManifestSchema,
  canonicalJson,
  DurableEventEnvelopeSchema,
  isEventSecretFieldName,
  MetricScalarSchema,
  PluginManifestSchema,
  TableRecordsSchema,
  UiDocumentSchema
} from "@k-nex/contracts";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormatsModule.default(ajv);
ajv.addKeyword({
  keyword: "kNexMaxCanonicalBytes",
  type: "object",
  schemaType: "number",
  errors: false,
  validate: (maximum: number, data: unknown) => new TextEncoder().encode(canonicalJson(data)).byteLength <= maximum
});
ajv.addKeyword({
  keyword: "kNexNoSecretFields",
  type: "object",
  schemaType: "boolean",
  errors: false,
  validate: (enabled: boolean, data: unknown) => {
    if (!enabled) return true;
    const visit = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.every(visit);
      if (value === null || typeof value !== "object") return true;
      return Object.entries(value).every(([key, child]) => !isEventSecretFieldName(key) && visit(child));
    };
    return visit(data);
  }
});
ajv.addKeyword({
  keyword: "kNexUiDocumentInvariants",
  type: "object",
  schemaType: "boolean",
  errors: false,
  validate: (enabled: boolean, data: unknown) => !enabled || UiDocumentSchema.safeParse(data).success
});

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
  "schemas/action.v1.schema.json",
  "schemas/agent-tool.v1.schema.json",
  "schemas/plugin-manifest.v1.schema.json",
  "schemas/application-manifest.v1.schema.json",
  "schemas/event.v1.schema.json",
  "schemas/metric-scalar.v1.schema.json",
  "schemas/table-records.v1.schema.json",
  "schemas/ui-document.v1.schema.json",
  "fixtures/actions/valid/complete.json",
  "fixtures/actions/invalid/non-canonical-id.json",
  "fixtures/agent-tools/valid/read.json",
  "fixtures/agent-tools/invalid/executable-handler.json",
  "fixtures/events/valid/durable.json",
  "fixtures/events/invalid/realtime-class.json",
  "fixtures/output-contracts/valid/metric-scalar.json",
  "fixtures/output-contracts/valid/table-records.json",
  "fixtures/output-contracts/invalid/metric-scalar.json",
  "fixtures/output-contracts/invalid/table-records.json",
  "fixtures/ui-documents/valid/cms.v1.json",
  "fixtures/ui-documents/valid/workspace.v1.json",
  "fixtures/ui-documents/invalid/duplicate-node-id.json",
  "fixtures/ui-documents/invalid/non-namespaced-engine-metadata.json",
  "fixtures/ui-documents/invalid/unrestricted-url.json",
  "fixtures/ui-documents/invalid/unsafe-script.json"
]) {
  await loadCanonical(relativePath);
}

const pluginSchema = await load<AnySchema>("schemas/plugin-manifest.v1.schema.json");
const actionSchema = await load<AnySchema>("schemas/action.v1.schema.json");
const agentToolSchema = await load<AnySchema>("schemas/agent-tool.v1.schema.json");
const applicationSchema = await load<AnySchema>("schemas/application-manifest.v1.schema.json");
const eventSchema = await load<AnySchema>("schemas/event.v1.schema.json");
const metricSchema = await load<AnySchema>("schemas/metric-scalar.v1.schema.json");
const tableSchema = await load<AnySchema>("schemas/table-records.v1.schema.json");
const uiDocumentSchema = await load<AnySchema>("schemas/ui-document.v1.schema.json");
const validatePlugin = ajv.compile(pluginSchema);
const validateAction = ajv.compile(actionSchema);
const validateAgentTool = ajv.compile(agentToolSchema);
const validateApplication = ajv.compile(applicationSchema);
const validateEvent = ajv.compile(eventSchema);
const validateMetric = ajv.compile(metricSchema);
const validateTable = ajv.compile(tableSchema);
const validateUiDocument = ajv.compile(uiDocumentSchema);

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
if (!generatedContracts.artifacts.includes("schemas/ui-document.v1.schema.json")) {
  throw new Error("Generated artifact inventory is missing schemas/ui-document.v1.schema.json.");
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

const validAction = await load("fixtures/actions/valid/complete.json");
if (!ActionDescriptorSchema.safeParse(validAction).success || !validateAction(validAction)) {
  throw new Error(`Valid action fixture failed its authoring or generated schema: ${ajv.errorsText(validateAction.errors)}`);
}
const invalidAction = await load("fixtures/actions/invalid/non-canonical-id.json");
if (ActionDescriptorSchema.safeParse(invalidAction).success || validateAction(invalidAction)) {
  throw new Error("Action fixture with a non-canonical ID must fail both authoring and generated schemas.");
}

const validEvent = await load("fixtures/events/valid/durable.json");
if (!DurableEventEnvelopeSchema.safeParse(validEvent).success || !validateEvent(validEvent)) {
  throw new Error(`Valid durable-event fixture failed its authoring or generated schema: ${ajv.errorsText(validateEvent.errors)}`);
}
const invalidEvent = await load("fixtures/events/invalid/realtime-class.json");
if (DurableEventEnvelopeSchema.safeParse(invalidEvent).success || validateEvent(invalidEvent)) {
  throw new Error("Realtime-class fixture must fail both durable-event authoring and generated schemas.");
}
const secretEvent = structuredClone(validEvent) as { payload: Record<string, unknown> };
secretEvent.payload = { nested: [{ "private-note": "must never enter an event" }] };
if (DurableEventEnvelopeSchema.safeParse(secretEvent).success || validateEvent(secretEvent)) {
  throw new Error("Secret-bearing event payload must fail both Zod and generated JSON Schema validation.");
}
for (const key of ["-password-", "_token_", "💣secret💣"]) {
  const separatedSecretEvent = structuredClone(validEvent) as { payload: Record<string, unknown> };
  separatedSecretEvent.payload = { [key]: "must never enter an event" };
  if (DurableEventEnvelopeSchema.safeParse(separatedSecretEvent).success || validateEvent(separatedSecretEvent)) {
    throw new Error(`Secret-bearing event key ${key} must fail both Zod and generated JSON Schema validation.`);
  }
}
const oversizedEvent = structuredClone(validEvent) as { payload: Record<string, unknown> };
oversizedEvent.payload = { data: "x".repeat(16_384) };
if (DurableEventEnvelopeSchema.safeParse(oversizedEvent).success || validateEvent(oversizedEvent)) {
  throw new Error("Oversized event payload must fail both Zod and generated JSON Schema validation.");
}

const validApplication = await load<Record<string, any>>("fixtures/customer-gate-1/k-nex.app.json");
if (!ApplicationManifestSchema.safeParse(validApplication).success || !validateApplication(validApplication)) {
  throw new Error(`Valid customer application must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(validateApplication.errors)}`);
}
const incompatibleTopology = structuredClone(validApplication);
incompatibleTopology.runtime.realtime.webInstances = 2;
if (ApplicationManifestSchema.safeParse(incompatibleTopology).success || validateApplication(incompatibleTopology)) {
  throw new Error("Incompatible memory topology must fail both Zod and generated JSON Schema validation.");
}
const missingTopology = structuredClone(validApplication);
delete missingTopology.runtime.realtime;
if (ApplicationManifestSchema.safeParse(missingTopology).success || validateApplication(missingTopology)) {
  throw new Error("Selecting realtime.gateway without runtime.realtime must fail both Zod and generated JSON Schema validation.");
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

const uiDocumentFixtures = [
  { path: "fixtures/ui-documents/valid/cms.v1.json", valid: true },
  { path: "fixtures/ui-documents/valid/workspace.v1.json", valid: true },
  { path: "fixtures/ui-documents/invalid/duplicate-node-id.json", valid: false },
  { path: "fixtures/ui-documents/invalid/non-namespaced-engine-metadata.json", valid: false },
  { path: "fixtures/ui-documents/invalid/secret-uri-bypasses.json", valid: false },
  { path: "fixtures/ui-documents/invalid/unrestricted-url.json", valid: false },
  { path: "fixtures/ui-documents/invalid/unsafe-script.json", valid: false }
] as const;
for (const fixture of uiDocumentFixtures) {
  const value = await load(fixture.path);
  const zodValid = UiDocumentSchema.safeParse(value).success;
  const jsonSchemaValid = validateUiDocument(value);
  if (fixture.valid && (!zodValid || !jsonSchemaValid)) {
    throw new Error(`Valid ${fixture.path} must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(validateUiDocument.errors)}`);
  }
  if (!fixture.valid && (zodValid || jsonSchemaValid)) {
    throw new Error(`Structurally invalid ${fixture.path} must fail both Zod and generated JSON Schema validation.`);
  }
}

console.log("Generated schemas compile with Ajv and preserve contract and lifecycle invariants.");
