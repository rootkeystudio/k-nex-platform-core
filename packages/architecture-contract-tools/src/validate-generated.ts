import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ActionDescriptorSchema,
  AgentToolDescriptorSchema,
  ApplicationManifestSchema,
  AuthorizationContractsSchema,
  canonicalJson,
  CmsPageMetadataSchema,
  DurableEventEnvelopeSchema,
  ExtensionBundleManifestSchema,
  ExtensionCapabilityRequestSchema,
  ExtensionGenerationSchema,
  ExtensionInstallPlanSchema,
  ExtensionInstallReceiptSchema,
  ExtensionLifecycleEventSchema,
  ExtensionResourceBudgetSchema,
  HotApplicationManifestSchema,
  isEventSecretFieldName,
  MigrationCompatibilityPlanSchema,
  MetricScalarSchema,
  PluginManifestSchema,
  TableRecordsSchema,
  ThemeSkinManifestSchema,
  ThemeProfileSchema,
  ThemeProfilePublicationEventSchema,
  RemoteUiIsolationProfileSchema,
  RemoteUiFrameSchema,
  RunnerIsolationProfileSchema,
  RuntimeExtensionInventorySchema,
  StaticCompositionChangePlanSchema,
  StaticDeploymentReceiptSchema,
  TrustedApplicationBuildEvidenceSchema,
  UiDocumentSchema,
  WorkerGenerationFenceSchema,
  ZeroDowntimeEligibilitySchema
} from "@k-nex/contracts";
import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { registerPluginContributionOwnershipKeyword } from "./plugin-contribution-ownership.js";
import { registerMigrationRevisionKeyword } from "./migration-compatibility-plan.js";
import { registerAuthorizationOwnershipKeyword } from "./authorization-ownership.js";
import { registerHotApplicationAuthorizationKeyword } from "./hot-application-authorization.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormatsModule.default(ajv);
registerPluginContributionOwnershipKeyword(ajv);
registerMigrationRevisionKeyword(ajv);
registerAuthorizationOwnershipKeyword(ajv);
registerHotApplicationAuthorizationKeyword(ajv);
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
  "schemas/hot-application-manifest.v1.schema.json",
  "schemas/theme-skin-manifest.v1.schema.json",
  "schemas/extension-bundle-manifest.v1.schema.json",
  "schemas/extension-capability-request.v1.schema.json",
  "schemas/extension-resource-budget.v1.schema.json",
  "schemas/extension-install-plan.v1.schema.json",
  "schemas/extension-install-receipt.v1.schema.json",
  "schemas/extension-lifecycle-event.v1.schema.json",
  "schemas/extension-generation.v1.schema.json",
  "schemas/zero-downtime-eligibility.v1.schema.json",
  "schemas/remote-ui-isolation-profile.v1.schema.json",
  "schemas/remote-ui-frame.v1.schema.json",
  "schemas/runner-isolation-profile.v1.schema.json",
  "schemas/runtime-extension-inventory.v1.schema.json",
  "schemas/static-composition-change-plan.v1.schema.json",
  "schemas/static-deployment-receipt.v1.schema.json",
  "schemas/trusted-application-build-evidence.v1.schema.json",
  "schemas/migration-compatibility-plan.v1.schema.json",
  "schemas/worker-generation-fence.v1.schema.json",
  "schemas/application-manifest.v1.schema.json",
  "schemas/event.v1.schema.json",
  "schemas/metric-scalar.v1.schema.json",
  "schemas/table-records.v1.schema.json",
  "schemas/theme-profile.v1.schema.json",
  "schemas/theme-profile-publication-event.v1.schema.json",
  "schemas/ui-document.v1.schema.json",
  "schemas/cms-page-metadata.v1.schema.json",
  "schemas/authorization.v1.schema.json",
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
  "fixtures/ui-documents/invalid/unsafe-script.json",
  "fixtures/cms-page-metadata/valid/public-home.json",
  "fixtures/cms-page-metadata/valid/boundaries.json",
  "fixtures/cms-page-metadata/invalid/dot-segment.json",
  "fixtures/cms-page-metadata/invalid/query-string.json",
  "fixtures/cms-page-metadata/invalid/leading-whitespace.json",
  "fixtures/cms-page-metadata/invalid/trailing-whitespace.json",
  "fixtures/cms-page-metadata/invalid/control-character.json",
  "fixtures/cms-page-metadata/invalid/title-too-long.json",
  "fixtures/theme-profiles/valid/public-minimal.json",
  "fixtures/theme-profiles/valid/public-minimal-skin.json",
  "fixtures/theme-profiles/valid/public-skin-publication-event.json",
  "fixtures/theme-profiles/invalid/non-theme-id.json",
  "fixtures/theme-profiles/invalid/unsafe-url.json",
  "fixtures/theme-profiles/invalid/unsafe-key.json",
  "fixtures/theme-profiles/invalid/too-many-overrides.json",
  "fixtures/theme-profiles/invalid/unsafe-skin.json",
  "fixtures/theme-profiles/invalid/publication-event-unsafe-generation.json",
  "fixtures/plugin-manifests/valid/module.sales.json",
  "fixtures/plugin-manifests/invalid/empty-category.json",
  "fixtures/plugin-manifests/invalid/invalid-requirement.json",
  "fixtures/plugin-manifests/invalid/unknown-category.json",
  "fixtures/plugin-manifests/invalid/wrong-owner.json"
]) {
  await loadCanonical(relativePath);
}

const authorizationFixtures = (await Promise.all(["valid", "invalid"].map(async (category) =>
  (await readdir(resolve(repositoryRoot, "fixtures/contracts", category)))
    .filter((name) => name.startsWith("authorization.") && name.endsWith(".json"))
    .sort()
    .map((name) => ({ path: `fixtures/contracts/${category}/${name}`, valid: category === "valid" }))
))).flat().sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
for (const { path } of authorizationFixtures) await loadCanonical(path);

const pluginSchema = await load<AnySchema>("schemas/plugin-manifest.v1.schema.json");
const actionSchema = await load<AnySchema>("schemas/action.v1.schema.json");
const agentToolSchema = await load<AnySchema>("schemas/agent-tool.v1.schema.json");
const applicationSchema = await load<AnySchema>("schemas/application-manifest.v1.schema.json");
const eventSchema = await load<AnySchema>("schemas/event.v1.schema.json");
const metricSchema = await load<AnySchema>("schemas/metric-scalar.v1.schema.json");
const tableSchema = await load<AnySchema>("schemas/table-records.v1.schema.json");
const themeProfileSchema = await load<AnySchema>("schemas/theme-profile.v1.schema.json");
const themeProfilePublicationEventSchema = await load<AnySchema>("schemas/theme-profile-publication-event.v1.schema.json");
const uiDocumentSchema = await load<AnySchema>("schemas/ui-document.v1.schema.json");
const cmsPageMetadataSchema = await load<AnySchema>("schemas/cms-page-metadata.v1.schema.json");
const authorizationSchema = await load<AnySchema>("schemas/authorization.v1.schema.json");
const validatePlugin = ajv.compile(pluginSchema);
const validateAction = ajv.compile(actionSchema);
const validateAgentTool = ajv.compile(agentToolSchema);
const validateApplication = ajv.compile(applicationSchema);
const validateEvent = ajv.compile(eventSchema);
const validateMetric = ajv.compile(metricSchema);
const validateTable = ajv.compile(tableSchema);
const validateThemeProfile = ajv.compile(themeProfileSchema);
const validateThemeProfilePublicationEvent = ajv.compile(themeProfilePublicationEventSchema);
const validateUiDocument = ajv.compile(uiDocumentSchema);
const validateCmsPageMetadata = ajv.compile(cmsPageMetadataSchema);
const validateAuthorization = ajv.compile(authorizationSchema);

const extensionSchemas = {
  "extension-bundle-manifest": { authoring: ExtensionBundleManifestSchema, generated: "schemas/extension-bundle-manifest.v1.schema.json" },
  "extension-capability-request": { authoring: ExtensionCapabilityRequestSchema, generated: "schemas/extension-capability-request.v1.schema.json" },
  "extension-generation": { authoring: ExtensionGenerationSchema, generated: "schemas/extension-generation.v1.schema.json" },
  "extension-install-plan": { authoring: ExtensionInstallPlanSchema, generated: "schemas/extension-install-plan.v1.schema.json" },
  "extension-install-receipt": { authoring: ExtensionInstallReceiptSchema, generated: "schemas/extension-install-receipt.v1.schema.json" },
  "extension-lifecycle-event": { authoring: ExtensionLifecycleEventSchema, generated: "schemas/extension-lifecycle-event.v1.schema.json" },
  "extension-resource-budget": { authoring: ExtensionResourceBudgetSchema, generated: "schemas/extension-resource-budget.v1.schema.json" },
  "hot-application-manifest": { authoring: HotApplicationManifestSchema, generated: "schemas/hot-application-manifest.v1.schema.json" },
  "migration-compatibility-plan": { authoring: MigrationCompatibilityPlanSchema, generated: "schemas/migration-compatibility-plan.v1.schema.json" },
  "remote-ui-isolation-profile": { authoring: RemoteUiIsolationProfileSchema, generated: "schemas/remote-ui-isolation-profile.v1.schema.json" },
  "remote-ui-frame": { authoring: RemoteUiFrameSchema, generated: "schemas/remote-ui-frame.v1.schema.json" },
  "runner-isolation-profile": { authoring: RunnerIsolationProfileSchema, generated: "schemas/runner-isolation-profile.v1.schema.json" },
  "runtime-extension-inventory": { authoring: RuntimeExtensionInventorySchema, generated: "schemas/runtime-extension-inventory.v1.schema.json" },
  "static-composition-change-plan": { authoring: StaticCompositionChangePlanSchema, generated: "schemas/static-composition-change-plan.v1.schema.json" },
  "static-deployment-receipt": { authoring: StaticDeploymentReceiptSchema, generated: "schemas/static-deployment-receipt.v1.schema.json" },
  "theme-skin-manifest": { authoring: ThemeSkinManifestSchema, generated: "schemas/theme-skin-manifest.v1.schema.json" },
  "trusted-application-build-evidence": { authoring: TrustedApplicationBuildEvidenceSchema, generated: "schemas/trusted-application-build-evidence.v1.schema.json" },
  "worker-generation-fence": { authoring: WorkerGenerationFenceSchema, generated: "schemas/worker-generation-fence.v1.schema.json" },
  "zero-downtime-eligibility": { authoring: ZeroDowntimeEligibilitySchema, generated: "schemas/zero-downtime-eligibility.v1.schema.json" }
} as const;
type ExtensionSchemaName = keyof typeof extensionSchemas;
const extensionValidators = Object.fromEntries(await Promise.all(Object.entries(extensionSchemas).map(async ([name, contract]) => [name, ajv.compile(await load<AnySchema>(contract.generated))]))) as Record<ExtensionSchemaName, ValidateFunction>;

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
if (!generatedContracts.artifacts.includes("schemas/theme-profile.v1.schema.json")) {
  throw new Error("Generated artifact inventory is missing schemas/theme-profile.v1.schema.json.");
}
if (!generatedContracts.artifacts.includes("schemas/theme-profile-publication-event.v1.schema.json")) {
  throw new Error("Generated artifact inventory is missing schemas/theme-profile-publication-event.v1.schema.json.");
}
if (!generatedContracts.artifacts.includes("schemas/cms-page-metadata.v1.schema.json")) {
  throw new Error("Generated artifact inventory is missing schemas/cms-page-metadata.v1.schema.json.");
}
if (!generatedContracts.artifacts.includes("schemas/authorization.v1.schema.json")) {
  throw new Error("Generated artifact inventory is missing schemas/authorization.v1.schema.json.");
}

for (const fixture of authorizationFixtures) {
  const value = await load(fixture.path);
  const zodValid = AuthorizationContractsSchema.safeParse(value).success;
  const jsonSchemaValid = validateAuthorization(value);
  if (fixture.valid && (!zodValid || !jsonSchemaValid)) {
    throw new Error(`Valid ${fixture.path} must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(validateAuthorization.errors)}`);
  }
  if (!fixture.valid && (zodValid || jsonSchemaValid)) {
    throw new Error(`Invalid ${fixture.path} must fail both Zod and generated JSON Schema validation.`);
  }
}
for (const { generated } of Object.values(extensionSchemas)) {
  if (!generatedContracts.artifacts.includes(generated)) throw new Error(`Generated artifact inventory is missing ${generated}.`);
}

const salesPlugin = await load("fixtures/plugin-manifests/valid/module.sales.json");
if (!PluginManifestSchema.safeParse(salesPlugin).success) throw new Error("Valid Sales fixture failed the Zod authoring schema.");
if (!validatePlugin(salesPlugin)) throw new Error(`Valid Sales fixture failed generated schema: ${ajv.errorsText(validatePlugin.errors)}`);

for (const path of [
  "fixtures/plugin-manifests/invalid/empty-category.json",
  "fixtures/plugin-manifests/invalid/invalid-requirement.json",
  "fixtures/plugin-manifests/invalid/unknown-category.json",
  "fixtures/plugin-manifests/invalid/wrong-owner.json"
]) {
  const fixture = await load(path);
  if (PluginManifestSchema.safeParse(fixture).success || validatePlugin(fixture)) {
    throw new Error(`Invalid plugin fixture must fail both Zod and generated JSON Schema validation: ${path}.`);
  }
}

const invalidLifecycle = structuredClone(salesPlugin) as { lifecycle: { uninstall: string } };
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
for (const key of [
  "-password-", "_token_", "💣secret💣", "accessToken", "access_token", "access-token", "refreshToken", "clientSecret", "sessionToken", "apiKeyValue",
  "credentials", "passwordHash", "authorizationHeader", "accessTokenValue", "refreshTokenValue", "clientSecretValue", "apiKeySecret"
]) {
  const separatedSecretEvent = structuredClone(validEvent) as { payload: Record<string, unknown> };
  separatedSecretEvent.payload = { [key]: "must never enter an event" };
  if (DurableEventEnvelopeSchema.safeParse(separatedSecretEvent).success || validateEvent(separatedSecretEvent)) {
    throw new Error(`Secret-bearing event key ${key} must fail both Zod and generated JSON Schema validation.`);
  }
}
for (const key of ["tokenCount", "token-count", "token_count", "tokenBudget", "token-budget", "token_budget", "secretaryName"]) {
  const safeMetadataEvent = structuredClone(validEvent) as { payload: Record<string, unknown> };
  safeMetadataEvent.payload = { [key]: 1 };
  if (!DurableEventEnvelopeSchema.safeParse(safeMetadataEvent).success || !validateEvent(safeMetadataEvent)) {
    throw new Error(`Safe event metadata key ${key} must pass both Zod and generated JSON Schema validation.`);
  }
}
for (const occurredAt of ["2026-08-26T12:00:00Z", "2026-08-26T12:00:00.000001Z", "2026-08-26T08:00:00.000-04:00", "2026-08-26T12:00:00.000+00:00"]) {
  const subMillisecondEvent = { ...(validEvent as Record<string, unknown>), occurredAt };
  if (DurableEventEnvelopeSchema.safeParse(subMillisecondEvent).success || validateEvent(subMillisecondEvent)) {
    throw new Error(`Non-millisecond event timestamp ${occurredAt} must fail both Zod and generated JSON Schema validation.`);
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

const validThemeProfile = {
  schemaVersion: 1,
  id: "theme-profile.public-default",
  surface: "public",
  themeId: "theme.minimal",
  themeVersion: "1.0.0",
  palette: "default",
  mode: "system",
  values: { "color.accent": "#2457ff" },
  revision: { id: "theme-revision.public-1", number: 1, state: "draft", createdAt: "2026-08-26T20:00:00.000Z" }
};
if (!ThemeProfileSchema.safeParse(validThemeProfile).success || !validateThemeProfile(validThemeProfile)) {
  throw new Error(`Valid theme profile must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(validateThemeProfile.errors)}`);
}
const unsafeThemeProfile = structuredClone(validThemeProfile) as Record<string, unknown>;
unsafeThemeProfile.className = "brand";
if (ThemeProfileSchema.safeParse(unsafeThemeProfile).success || validateThemeProfile(unsafeThemeProfile)) {
  throw new Error("Theme profile unknown keys must fail both Zod and generated JSON Schema validation.");
}
const themeProfileFixtures = [
  { path: "fixtures/theme-profiles/valid/public-minimal.json", valid: true },
  { path: "fixtures/theme-profiles/valid/public-minimal-skin.json", valid: true },
  { path: "fixtures/theme-profiles/invalid/non-theme-id.json", valid: false },
  { path: "fixtures/theme-profiles/invalid/unsafe-url.json", valid: false },
  { path: "fixtures/theme-profiles/invalid/unsafe-key.json", valid: false },
  { path: "fixtures/theme-profiles/invalid/too-many-overrides.json", valid: false },
  { path: "fixtures/theme-profiles/invalid/unsafe-skin.json", valid: false }
] as const;
for (const fixture of themeProfileFixtures) {
  const value = await load(fixture.path);
  const zodValid = ThemeProfileSchema.safeParse(value).success;
  const jsonSchemaValid = validateThemeProfile(value);
  if (fixture.valid && (!zodValid || !jsonSchemaValid)) throw new Error(`Valid ${fixture.path} must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(validateThemeProfile.errors)}`);
  if (!fixture.valid && (zodValid || jsonSchemaValid)) throw new Error(`Invalid ${fixture.path} must fail both Zod and generated JSON Schema validation.`);
}

for (const fixture of [
  { path: "fixtures/theme-profiles/valid/public-skin-publication-event.json", valid: true },
  { path: "fixtures/theme-profiles/invalid/publication-event-unsafe-generation.json", valid: false }
] as const) {
  const value = await load(fixture.path);
  const zodValid = ThemeProfilePublicationEventSchema.safeParse(value).success;
  const jsonSchemaValid = validateThemeProfilePublicationEvent(value);
  if (fixture.valid && (!zodValid || !jsonSchemaValid)) throw new Error(`Valid ${fixture.path} must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(validateThemeProfilePublicationEvent.errors)}`);
  if (!fixture.valid && (zodValid || jsonSchemaValid)) throw new Error(`Invalid ${fixture.path} must fail both Zod and generated JSON Schema validation.`);
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

const cmsPageMetadataFixtures = [
  { path: "fixtures/cms-page-metadata/valid/public-home.json", valid: true },
  { path: "fixtures/cms-page-metadata/valid/boundaries.json", valid: true },
  { path: "fixtures/cms-page-metadata/invalid/dot-segment.json", valid: false },
  { path: "fixtures/cms-page-metadata/invalid/query-string.json", valid: false },
  { path: "fixtures/cms-page-metadata/invalid/leading-whitespace.json", valid: false },
  { path: "fixtures/cms-page-metadata/invalid/trailing-whitespace.json", valid: false },
  { path: "fixtures/cms-page-metadata/invalid/control-character.json", valid: false },
  { path: "fixtures/cms-page-metadata/invalid/title-too-long.json", valid: false }
] as const;
for (const fixture of cmsPageMetadataFixtures) {
  const value = await load(fixture.path);
  const zodValid = CmsPageMetadataSchema.safeParse(value).success;
  const jsonSchemaValid = validateCmsPageMetadata(value);
  if (fixture.valid && (!zodValid || !jsonSchemaValid)) throw new Error(`Valid ${fixture.path} must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(validateCmsPageMetadata.errors)}`);
  if (!fixture.valid && (zodValid || jsonSchemaValid)) throw new Error(`Invalid ${fixture.path} must fail both Zod and generated JSON Schema validation.`);
}

const extensionValidFixtures = [
  "fixtures/extensions/valid/capability.records.json",
  "fixtures/extensions/valid/hot-application.bundle.json",
  "fixtures/extensions/valid/hot-application.generation.json",
  "fixtures/extensions/valid/hot-application.install-plan.json",
  "fixtures/extensions/valid/hot-application.install-receipt.json",
  "fixtures/extensions/valid/hot-application.manifest.json",
  "fixtures/extensions/valid/extension-lifecycle-event.json",
  "fixtures/extensions/valid/migration-compatibility-plan.json",
  "fixtures/extensions/valid/platform-plugin.bundle.json",
  "fixtures/extensions/valid/platform-plugin.eligibility.json",
  "fixtures/extensions/valid/platform-plugin.maintenance-required.json",
  "fixtures/extensions/valid/platform-plugin.unsupported.json",
  "fixtures/extensions/valid/resource-budget.hot-application.json",
  "fixtures/extensions/valid/remote-ui-isolation-profile.json",
  "fixtures/extensions/valid/runner-isolation-profile.json",
  "fixtures/extensions/valid/runtime-extension-inventory.json",
  "fixtures/extensions/valid/static-composition-change-plan.json",
  "fixtures/extensions/valid/static-deployment-receipt.json",
  "fixtures/extensions/valid/theme-skin.bundle.json",
  "fixtures/extensions/valid/theme-skin.manifest.json",
  "fixtures/extensions/valid/trusted-application-build-evidence.json",
  "fixtures/extensions/valid/worker-generation-fence.json"
] as const;

function extensionSchemaName(value: unknown): ExtensionSchemaName {
  const declared = value !== null && typeof value === "object" ? (value as Record<string, unknown>)["$schema"] : undefined;
  if (typeof declared !== "string") throw new Error("Extension fixture must declare $schema.");
  const match = Object.entries(extensionSchemas).find(([, contract]) => declared.endsWith(contract.generated.split("/").at(-1)!));
  if (match === undefined) throw new Error(`Extension fixture declares an unknown schema: ${declared}.`);
  return match[0] as ExtensionSchemaName;
}

for (const path of extensionValidFixtures) {
  const value = await load(path);
  const name = extensionSchemaName(value);
  const zodValid = extensionSchemas[name].authoring.safeParse(value).success;
  const jsonSchemaValid = extensionValidators[name](value);
  if (!zodValid || !jsonSchemaValid) throw new Error(`Valid ${path} must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(extensionValidators[name].errors)}`);
}

const migrationFreePlan = structuredClone(await load<Record<string, any>>("fixtures/extensions/valid/migration-compatibility-plan.json"));
migrationFreePlan.plan.steps = [];
migrationFreePlan.plan.baseRevision = 12;
migrationFreePlan.plan.targetRevision = 12;
const migrationPlanValidator = extensionValidators["migration-compatibility-plan"];
if (!MigrationCompatibilityPlanSchema.safeParse(migrationFreePlan).success || !migrationPlanValidator(migrationFreePlan)) {
  throw new Error(`Migration-free same-revision plan must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(migrationPlanValidator.errors)}`);
}

const staticMigrationFreePlan = structuredClone(await load<Record<string, any>>("fixtures/extensions/valid/static-composition-change-plan.json"));
staticMigrationFreePlan.migration.steps = [];
staticMigrationFreePlan.migration.baseRevision = 12;
staticMigrationFreePlan.migration.targetRevision = 12;
const staticCompositionPlanValidator = extensionValidators["static-composition-change-plan"];
if (!StaticCompositionChangePlanSchema.safeParse(staticMigrationFreePlan).success || !staticCompositionPlanValidator(staticMigrationFreePlan)) {
  throw new Error(`Static migration-free same-revision plan must pass both Zod and generated JSON Schema validation: ${ajv.errorsText(staticCompositionPlanValidator.errors)}`);
}

for (const [baseRevision, targetRevision] of [[12, 13], [13, 12]] as const) {
  const standalone = structuredClone(migrationFreePlan);
  standalone.plan.baseRevision = baseRevision;
  standalone.plan.targetRevision = targetRevision;
  const embedded = structuredClone(staticMigrationFreePlan);
  embedded.migration.baseRevision = baseRevision;
  embedded.migration.targetRevision = targetRevision;
  if (MigrationCompatibilityPlanSchema.safeParse(standalone).success || migrationPlanValidator(standalone)) {
    throw new Error(`Empty standalone migration plan ${baseRevision}->${targetRevision} must fail both Zod and generated JSON Schema validation.`);
  }
  if (StaticCompositionChangePlanSchema.safeParse(embedded).success || staticCompositionPlanValidator(embedded)) {
    throw new Error(`Empty embedded migration plan ${baseRevision}->${targetRevision} must fail both Zod and generated JSON Schema validation.`);
  }
}

const themeSkinManifest = await load<Record<string, unknown>>("fixtures/extensions/valid/theme-skin.manifest.json");
for (const [token, valid] of [["#ABC", true], ["#ABCD", true], ["#A1B2C3", true], ["#A1B2C3D4", true], ["#ABCDE", false], ["#A1B2C3D", false]] as const) {
  const value = structuredClone(themeSkinManifest);
  (value.tokens as Record<string, string>)["--k-nex-skin-color-accent"] = token;
  const zodValid = ThemeSkinManifestSchema.safeParse(value).success;
  const jsonSchemaValid = extensionValidators["theme-skin-manifest"](value);
  if (zodValid !== valid || jsonSchemaValid !== valid || zodValid !== jsonSchemaValid) throw new Error(`Theme Skin token ${token} must preserve Zod/Ajv parity.`);
}

const extensionInvalidFixtures = await load<Record<string, { schema: ExtensionSchemaName }>>("fixtures/extensions/expected-diagnostics.json");
for (const [path, declaration] of Object.entries(extensionInvalidFixtures)) {
  const value = await load(path);
  const zodValid = extensionSchemas[declaration.schema].authoring.safeParse(value).success;
  const jsonSchemaValid = extensionValidators[declaration.schema](value);
  if (zodValid || jsonSchemaValid) throw new Error(`Invalid ${path} must fail both Zod and generated JSON Schema validation.`);
}

console.log("Generated schemas compile with Ajv and preserve contract and lifecycle invariants.");
